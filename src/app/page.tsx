import { Suspense } from "react";
import { Explore } from "@/components/Explore";
import { defaultListing, PERIODS, SORTS, type PeriodKey, type SortKey } from "@/lib/makerworld.ts";

export default function Home(props: PageProps<"/">) {
  return (
    <Suspense fallback={<main className="container muted">Loading…</main>}>
      <HomeContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function HomeContent({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const mode = q.trim() ? "search" : "browse";
  const defaults = defaultListing(q);
  const sorts = (Object.keys(SORTS) as SortKey[]).filter((k) => SORTS[k][mode]).map((key) => ({ key, label: SORTS[key].label }));
  const periods = (Object.keys(PERIODS) as PeriodKey[]).map((key) => ({ key, label: PERIODS[key].label }));
  const sort = typeof sp.sort === "string" && sorts.some((s) => s.key === sp.sort) ? sp.sort : defaults.sort;
  const period = typeof sp.period === "string" && sp.period in PERIODS ? sp.period : defaults.period;
  return <Explore key={`${q}|${sort}|${period}`} query={q} sort={sort} period={period} sorts={sorts} periods={periods} defaults={defaults} />;
}
