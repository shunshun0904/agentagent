#!/usr/bin/env python3
"""
Supabase の接続文字列を検査・正規化する(scripts/gcp/*.sh から使う)。

使い方:
  python3 dburl.py normalize DATABASE_URL "<接続文字列>"   正規化した文字列を標準出力に出す
  python3 dburl.py describe "<接続文字列>"                  パスワードを除いた接続先を表示する
  python3 dburl.py libpq "<接続文字列>"                     psql で使えないパラメータを取り除いて出力する

normalize が行うこと:
  - パスワードの前後に残った [ ] を取り除く(Supabase の表示 [YOUR-PASSWORD] の置き換え漏れ)
  - パスワードに含まれる記号を URL エンコードする(@ # / ? : % などで接続文字列が壊れるのを防ぐ)
  - 直接接続(db.<ref>.supabase.co、IPv6 専用)を拒否する
  - 接続プールでユーザー名が postgres.<プロジェクトID> 形式になっているか確認する
  - DIRECT_URL に sslmode=require を付ける
エラーは終了コード 1 と標準エラーのメッセージで知らせる。補足(自動修正の内容など)は標準エラーに出す。
"""
import re
import sys
import urllib.parse


class UrlError(Exception):
    pass


def split_url(raw: str):
    m = re.match(r"^(postgres(?:ql)?)://(.*)$", raw)
    if not m:
        raise UrlError("postgresql:// で始まる接続文字列を入力してください")
    scheme, rest = m.groups()
    at = rest.rfind("@")
    if at < 0:
        raise UrlError("接続文字列にユーザー名とパスワードが含まれていません")
    userinfo, hostrest = rest[:at], rest[at + 1 :]
    user, sep, password = userinfo.partition(":")
    if not sep or password == "":
        raise UrlError("接続文字列にパスワードが含まれていません")
    hostport, slash, tail = hostrest.partition("/")
    path_and_query = slash + tail
    if hostport.count(":") == 1:
        host, port = hostport.split(":")
    else:
        host, port = hostport, ""
    return scheme, user, password, host, port, path_and_query


def normalize(kind: str, raw: str):
    notes = []
    raw = raw.strip()
    if "[YOUR-PASSWORD]" in raw:
        raise UrlError("[YOUR-PASSWORD] を実際のパスワードに置き換えてください")
    scheme, user, password, host, port, path_and_query = split_url(raw)

    if password.startswith("[") and password.endswith("]") and len(password) > 2:
        password = password[1:-1]
        notes.append("パスワードの前後に残っていた [ ] を取り除きました")

    # 既に %XX でエンコード済みならそのまま、そうでなければ記号をエンコードする
    if urllib.parse.unquote(password) == password:
        encoded = urllib.parse.quote(password, safe="")
        if encoded != password:
            notes.append("パスワードに含まれる記号を URL エンコードしました")
        password = encoded

    host_l = host.lower()
    if re.match(r"^db\.[a-z0-9]+\.supabase\.co$", host_l):
        raise UrlError(
            "これは Supabase の「Direct connection」(IPv6 専用)の接続文字列です。Cloud Run からは接続できません。"
            "「Connect」画面で Transaction pooler(ポート 6543)または Session pooler(ポート 5432)の文字列を使ってください"
        )
    is_pooler = host_l.endswith(".pooler.supabase.com")
    if is_pooler and "." not in user:
        raise UrlError(
            "接続プールでは、ユーザー名を postgres.<プロジェクトID> の形式にする必要があります(Supabase の「Connect」画面の文字列をそのまま使ってください)"
        )
    if not port.isdigit():
        raise UrlError("接続文字列のポート番号を読み取れません。パスワード以外の部分が正しいか確認してください")
    if kind == "DIRECT_URL" and port == "6543":
        raise UrlError("DIRECT_URL には Session pooler(ポート 5432)の接続文字列を指定してください")
    if kind == "DATABASE_URL" and port != "6543":
        notes.append("DATABASE_URL は Transaction pooler(ポート 6543)を推奨します")
    if host_l.endswith("supabase.com") and not is_pooler:
        notes.append("ホスト名が Supabase の接続プール(*.pooler.supabase.com)ではありません")

    url = f"{scheme}://{user}:{password}@{host}:{port}{path_and_query or '/postgres'}"
    if kind == "DIRECT_URL" and "sslmode=" not in url:
        url += ("&" if "?" in url else "?") + "sslmode=require"

    # 最終確認: 標準的な URL として解釈できること
    parsed = urllib.parse.urlsplit(url)
    if parsed.hostname is None or parsed.port is None:
        raise UrlError("接続文字列を解釈できません")
    return url, notes


# Prisma や node-postgres だけが使うパラメータ(psql/libpq に渡すとエラーになる)
NON_LIBPQ_PARAMS = {"schema", "pgbouncer", "connection_limit", "pool_timeout", "sslaccept", "socket_timeout", "statement_cache_size"}


def for_libpq(raw: str) -> str:
    """psql で接続確認するために、libpq が知らないパラメータを取り除く"""
    parts = urllib.parse.urlsplit(raw.strip())
    query = [(k, v) for k, v in urllib.parse.parse_qsl(parts.query, keep_blank_values=True) if k not in NON_LIBPQ_PARAMS]
    return urllib.parse.urlunsplit(parts._replace(query=urllib.parse.urlencode(query)))


def describe(raw: str) -> str:
    try:
        _, user, _, host, port, path_and_query = split_url(raw.strip())
    except UrlError:
        return "(解析できない形式)"
    db = path_and_query.split("?")[0].lstrip("/") or "postgres"
    return f"{user}@{host}:{port or '5432'}/{db}"


def main(argv):
    if len(argv) >= 4 and argv[1] == "normalize":
        try:
            url, notes = normalize(argv[2], argv[3])
        except UrlError as e:
            print(str(e), file=sys.stderr)
            return 1
        for n in notes:
            print(f"NOTE: {n}", file=sys.stderr)
        print(url)
        return 0
    if len(argv) >= 3 and argv[1] == "describe":
        print(describe(argv[2]))
        return 0
    if len(argv) >= 3 and argv[1] == "libpq":
        print(for_libpq(argv[2]))
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
