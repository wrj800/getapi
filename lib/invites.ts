import { redisCommand, redisGetJson, redisSetJson } from "@/lib/store";

export type InviteRecord = {
  code: string;
  note: string;
  maxUses: number;
  used: number;
  createdAt: string;
  createdBy: string;
  disabled?: boolean;
};

function inviteKey(code: string) {
  return `invite:${code.trim().toUpperCase()}`;
}

export function normalizeInviteCode(code: string) {
  return code.trim().replace(/\s+/g, "").toUpperCase();
}

export function generateInviteCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (const byte of bytes) {
    code += alphabet[byte % alphabet.length];
  }
  return code;
}

export async function createInvite(input: {
  createdBy: string;
  note?: string;
  maxUses?: number;
}) {
  const code = generateInviteCode();
  const invite: InviteRecord = {
    code,
    note: input.note?.trim().slice(0, 80) || "公益站邀请码",
    maxUses: Math.max(1, Math.floor(input.maxUses ?? 1)),
    used: 0,
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy
  };

  await redisSetJson(inviteKey(code), invite);
  await redisCommand<number>(["SADD", "invites:index", code]);
  return invite;
}

export async function listInvites() {
  const codes = await redisCommand<string[]>(["SMEMBERS", "invites:index"]);
  const invites = await Promise.all((codes ?? []).map((code) => redisGetJson<InviteRecord>(inviteKey(code))));
  return invites
    .filter((invite): invite is InviteRecord => Boolean(invite))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function consumeInvite(rawCode: string) {
  const code = normalizeInviteCode(rawCode);
  if (!code) {
    throw new Error("请输入邀请码。");
  }

  const invite = await redisGetJson<InviteRecord>(inviteKey(code));
  if (!invite || invite.disabled) {
    throw new Error("邀请码无效。");
  }

  if (invite.used >= invite.maxUses) {
    throw new Error("邀请码已用完。");
  }

  const next: InviteRecord = {
    ...invite,
    used: invite.used + 1
  };
  await redisSetJson(inviteKey(code), next);
  return next;
}

export async function disableInvite(code: string) {
  const normalized = normalizeInviteCode(code);
  const invite = await redisGetJson<InviteRecord>(inviteKey(normalized));
  if (!invite) {
    throw new Error("邀请码不存在。");
  }
  const next = { ...invite, disabled: true };
  await redisSetJson(inviteKey(normalized), next);
  return next;
}
