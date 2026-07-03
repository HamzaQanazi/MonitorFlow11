// Placeholder for Section 4 pages not built yet — not a new page, a stub for
// a frozen one so the shell nav can exist before its targets do.
export default function ComingSoon({ title, note }: { title: string; note: string }) {
  return (
    <div className="shell-empty-wrap">
      <div className="shell-empty">
        <h1>{title}</h1>
        <p>{note}</p>
      </div>
    </div>
  )
}
