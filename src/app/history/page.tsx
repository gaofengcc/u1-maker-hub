import { HistoryView } from "@/components/HistoryView";
import { t } from "@/lib/i18n";

export const metadata = { title: `${t("history.title")} · U1 模型工坊` };

export default function HistoryPage() {
  return <HistoryView />;
}
