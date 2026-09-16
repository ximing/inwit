export function PageHead({ title, lede }: { title: string; lede?: string }) {
  return (
    <header className="page-head">
      <h1 className="page-title">{title}</h1>
      {lede ? <p className="page-lede">{lede}</p> : null}
    </header>
  );
}
