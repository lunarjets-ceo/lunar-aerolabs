/** "Download CSV / PDF" for a download log; `filter` is e.g. "file=<id>" or "repo=<id>". */
export function ExportLinks({ filter }: { filter?: string }) {
  const base = `/sign/admin/downloads/export?${filter ? `${filter}&` : ''}format=`
  return (
    <div className="export-links">
      <a className="btn btn-small" href={`${base}csv`} download>
        Download CSV
      </a>
      <a className="btn btn-small" href={`${base}pdf`} download>
        Download PDF
      </a>
    </div>
  )
}
