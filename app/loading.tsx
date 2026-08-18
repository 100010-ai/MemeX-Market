export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl mxm-page-enter">
      <div className="flex gap-2">
        <div className="mxm-skeleton h-10 flex-1 rounded-[18px]" />
        <div className="mxm-skeleton h-10 w-10 rounded-[18px]" />
      </div>
      <div className="mxm-hscroll mt-2 flex gap-1.5">
        {Array.from({ length: 6 }, (_, index) => <div key={index} className="mxm-skeleton h-9 w-24 shrink-0 rounded-[16px]" />)}
      </div>
      <div className="market-grid mt-3 grid gap-2.5">
        {Array.from({ length: 8 }, (_, index) => <div key={index} className="overflow-hidden rounded-[20px] border border-[var(--border)] bg-[var(--panel)]"><div className="mxm-skeleton aspect-square"/><div className="p-2.5"><div className="mxm-skeleton h-3.5 rounded-lg"/><div className="mxm-skeleton mt-2 h-8 rounded-xl"/></div></div>)}
      </div>
    </div>
  );
}
