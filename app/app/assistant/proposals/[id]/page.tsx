import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getContext } from "@/lib/context";
import { getProposal } from "@/lib/services/assistant";
import { customerOptions } from "@/lib/services/customers";
import { productOptions } from "@/lib/services/products";
import { addDays, formatDateTime, todayInLagos } from "@/lib/dates";
import { koboToInput } from "@/lib/money";
import { idOr404, or404 } from "@/lib/page";
import { approveProposalAction, rejectProposalAction } from "../../actions";
import { InvoiceForm } from "../../../invoices/invoice-form";
import { InfoNotice, PageHeader, PageSkeleton } from "@/components/ui/notice";
import { ProposalBadge } from "@/components/ui/status";
import { AlertIcon } from "@/components/ui/icons";

export const metadata: Metadata = { title: "Review proposal" };

async function Content({ params }: { params: PageProps<"/app/assistant/proposals/[id]">["params"] }) {
  const ctx = await getContext();
  const proposal = await or404(getProposal(ctx, idOr404((await params).id)));
  const p = proposal.payload;
  const today = todayInLagos();

  return (
    <>
      <PageHeader
        title="Proposed invoice"
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <ProposalBadge status={proposal.status} /> drafted {formatDateTime(proposal.createdAt)}
            {proposal.createdByName ? ` by ${proposal.createdByName}` : ""}
          </span>
        }
      />
      <figure className="card mb-6 p-4">
        <figcaption className="text-sm font-semibold text-ink-2">The note it was drafted from</figcaption>
        <blockquote className="mt-1 whitespace-pre-line border-l-4 border-gold pl-3">{p.note}</blockquote>
      </figure>

      {proposal.status !== "pending" ? (
        <InfoNotice title={`This proposal is ${proposal.status}`}>
          {proposal.resultingInvoiceId ? (
            <Link href={`/app/invoices/${proposal.resultingInvoiceId}`}>Open the invoice it created</Link>
          ) : (
            "Nothing was created from it."
          )}
        </InfoNotice>
      ) : (
        <>
          {p.questions.length ? (
            <section className="mb-6 rounded-lg border-[3px] border-ink p-4" aria-labelledby="questions">
              <h2 id="questions" className="flex items-center gap-2 font-sans text-base font-bold">
                <AlertIcon /> Please decide these before approving
              </h2>
              <ul className="mt-2 list-disc space-y-1 pl-6">
                {p.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </section>
          ) : null}
          <p className="mb-4 text-ink-2">
            Nothing has been created yet. Check every line, change anything that&apos;s wrong, then approve. Approving checks everything again, exactly like the
            normal invoice form, and the totals are computed by Ledgerline, not by the AI.
          </p>
          <ApproveForm proposalId={proposal.id} payload={p} today={today} ctxLoader={ctx} />
          <form action={rejectProposalAction} className="mt-6 border-t border-line pt-4">
            <input type="hidden" name="proposalId" value={proposal.id} />
            <button type="submit" className="btn btn-secondary">
              Reject proposal
            </button>
          </form>
        </>
      )}
    </>
  );
}

async function ApproveForm({
  proposalId,
  payload,
  today,
  ctxLoader,
}: {
  proposalId: string;
  payload: Awaited<ReturnType<typeof getProposal>>["payload"];
  today: string;
  ctxLoader: Awaited<ReturnType<typeof getContext>>;
}) {
  const [customers, products] = await Promise.all([customerOptions(ctxLoader), productOptions(ctxLoader)]);
  return (
    <InvoiceForm
      customers={customers}
      products={products.map((x) => ({ id: x.id, name: x.name, unit: x.unit, priceKobo: x.priceKobo, stockQuantity: x.stockQuantity }))}
      requestId={proposalId}
      proposalId={proposalId}
      action={approveProposalAction}
      defaults={{
        // Ambiguous or unknown matches start EMPTY: the person chooses, nothing is guessed.
        customerId: payload.customer.status === "matched" ? payload.customer.selected?.id : undefined,
        issueDate: today,
        dueDate: payload.dueDate && payload.dueDate >= today ? payload.dueDate : addDays(today, 7),
        deliveryFee: payload.deliveryFeeKobo ? koboToInput(payload.deliveryFeeKobo) : "",
        discount: payload.discountKobo ? koboToInput(payload.discountKobo) : "",
        lines: payload.lines.map((l, i) => ({
          key: `p${i}`,
          productId: l.status === "matched" && l.selected ? l.selected.id : "",
          description: l.status === "matched" ? "" : l.query,
          quantity: String(l.quantity),
          unitPrice: l.unitPriceKobo ? koboToInput(l.unitPriceKobo) : "",
        })),
      }}
    />
  );
}

export default function ProposalPage(props: PageProps<"/app/assistant/proposals/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton label="Loading proposal" />}>
      <Content params={props.params} />
    </Suspense>
  );
}
