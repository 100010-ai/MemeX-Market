import caseSeriesArt from "@/components/case-series-art.module.css";

export default function CasesLayout({ children }: { children: React.ReactNode }) {
  return <div className={caseSeriesArt.loaded}>{children}</div>;
}
