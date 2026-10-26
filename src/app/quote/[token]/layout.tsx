export default function QuoteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-100/70 text-slate-900 antialiased py-6 sm:py-10">
      {children}
    </div>
  );
}
