import type { PrintTable } from "./printTable";

/** The sheet table: fixed layout from the sheet's widths/heights, the first row repeats on every page. */
export function PrintTableView({ table, zoom }: { table: PrintTable; zoom: number }) {
  const [head, ...body] = table.rows;
  const row = (r: PrintTable["rows"][number]) => (
    <tr key={r.row} style={{ height: r.height }} data-row={r.row}>
      {r.cells.map((c) => (
        <td key={c.col} style={c.style} className="print-cell">
          {c.text}
        </td>
      ))}
    </tr>
  );
  return (
    <table
      data-testid="print-table"
      className="print-table"
      style={{ width: table.width, tableLayout: "fixed", borderCollapse: "collapse", zoom: zoom === 1 ? undefined : zoom }}
    >
      <colgroup>
        {table.cols.map((c) => (
          <col key={c.col} style={{ width: c.width }} />
        ))}
      </colgroup>
      {head && <thead style={{ display: "table-header-group" }}>{row(head)}</thead>}
      <tbody>{body.map(row)}</tbody>
    </table>
  );
}
