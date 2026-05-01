import { redirect } from "next/navigation";
import {
  verifyActionToken,
  type ActionTokenPayload,
} from "@/lib/listings/action-token";
import { getT } from "@/lib/i18n/server";
import type { T, TKey } from "@/lib/i18n/dict";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ListingActionPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const params = await searchParams;
  const token = params.t;
  const { t } = await getT();
  if (!token) {
    return <ErrorView message={t("listingAction.noToken")} t={t} />;
  }

  let payload: ActionTokenPayload;
  try {
    payload = await verifyActionToken(token);
  } catch (e) {
    console.error("[listing-action] token verify failed", e);
    return <ErrorView message={t("listingAction.tokenInvalid")} t={t} />;
  }

  if (payload.action === "reply") {
    redirect(`/matches/${payload.match_id}`);
  }

  return <ConfirmationView token={token} action={payload.action} t={t} />;
}

function ConfirmationView({
  token,
  action,
  t,
}: {
  token: string;
  action: string;
  t: T;
}) {
  const headlineKey: TKey =
    action === "mark_rented"
      ? "listingAction.h.mark_rented"
      : action === "mark_reserved"
        ? "listingAction.h.mark_reserved"
        : action === "still_available"
          ? "listingAction.h.still_available"
          : action === "wrong_listing"
            ? "listingAction.h.wrong_listing"
            : "listingAction.h.default";
  const bodyKey: TKey | null =
    action === "mark_rented"
      ? "listingAction.b.mark_rented"
      : action === "mark_reserved"
        ? "listingAction.b.mark_reserved"
        : action === "still_available"
          ? "listingAction.b.still_available"
          : action === "wrong_listing"
            ? "listingAction.b.wrong_listing"
            : null;

  return (
    <main className="mx-auto max-w-md p-8 text-center">
      <h1 className="text-xl font-semibold mb-3">{t(headlineKey)}</h1>
      {bodyKey && (
        <p className="text-sm text-[var(--muted-foreground)] mb-6">{t(bodyKey)}</p>
      )}
      <form method="POST" action="/api/listing-action">
        <input type="hidden" name="t" value={token} />
        <button
          type="submit"
          className="bg-[var(--primary)] text-[var(--primary-foreground)] px-5 py-2.5 rounded-md font-medium hover:opacity-90"
        >
          {t("listingAction.confirm")}
        </button>
      </form>
      <p className="mt-6 text-xs text-[var(--muted-foreground)]">
        {t("listingAction.notYou")}
      </p>
    </main>
  );
}

function ErrorView({ message, t }: { message: string; t: T }) {
  return (
    <main className="mx-auto max-w-md p-8 text-center">
      <div className="mb-4 text-4xl">⚠️</div>
      <h1 className="text-xl font-semibold mb-2">{t("listingAction.oops")}</h1>
      <p className="text-[var(--muted-foreground)]">{message}</p>
    </main>
  );
}
