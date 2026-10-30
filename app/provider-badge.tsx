import { providerConfig, providerLabel } from "@/lib/ai/config";
import { SparkIcon } from "@/components/ui/icons";

/** Shows which AI provider is configured (the README explains the fallback). */
export function ProviderBadge() {
  const config = providerConfig();
  return (
    <p className="inline-flex items-center gap-2 rounded-full border border-field px-3 py-1 text-sm">
      <SparkIcon className="h-4 w-4" />
      <span>
        Assistant: <strong>{providerLabel(config)}</strong>
      </span>
    </p>
  );
}
