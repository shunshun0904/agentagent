-- 送信者の判定基準を「フリーランス(業務委託)向けの案件紹介」に限定したため、
-- AI の判定で自動登録したエージェントと、そのやり取り(担当者、スレッド、メール、返信案、案件)を消し、
-- 次回の同期で取り込み範囲全体を判定し直す。手動で登録したエージェントは残す。
-- エージェント以外と判定した送信者(NOT_AGENT)は、新しい基準でもエージェントにならないため残す。
DELETE FROM "Opportunity" WHERE "agentId" IN (SELECT id FROM "Agent" WHERE notes = 'メールの送信者から自動登録');
DELETE FROM "Thread" WHERE "agentId" IN (SELECT id FROM "Agent" WHERE notes = 'メールの送信者から自動登録');
DELETE FROM "Agent" WHERE notes = 'メールの送信者から自動登録';
DELETE FROM "SenderVerdict" WHERE kind = 'AGENT';
UPDATE "GoogleAccount" SET "syncedLookbackDays" = NULL;
