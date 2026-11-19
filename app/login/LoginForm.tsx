"use client";

import { useState } from "react";

export function LoginForm({ next }: { next: string }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/gb/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: code }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        setError(body?.error ?? "확인하지 못했어요. 잠시 후 다시 시도해 주세요.");
        return;
      }
      window.location.replace(next);
    } catch {
      setError("서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="v2-recovery">
    <form onSubmit={submit} style={{ display: "grid", gap: "var(--uc-space-12)", width: "min(320px, calc(100vw - 32px))" }}>
      <h1>관리자 비밀번호</h1>
      <p>언클로젯 운영 화면은 비밀번호를 아는 사람만 볼 수 있어요.</p>
      <input
        type="password"
        value={code}
        onChange={(event) => setCode(event.target.value)}
        autoFocus
        autoComplete="current-password"
        aria-label="관리자 비밀번호"
        style={{ padding: "var(--uc-space-10) var(--uc-space-12)", border: "1px solid var(--uc-line-control)", borderRadius: "var(--uc-radius-3)", fontSize: "var(--uc-fs-16)" }}
      />
      {error ? <small role="alert" style={{ color: "var(--uc-red-ink)" }}>{error}</small> : null}
      <button type="submit" disabled={!code || busy}>{busy ? "확인 중…" : "들어가기"}</button>
    </form>
  </main>;
}
