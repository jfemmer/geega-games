import type { ReactNode } from "react";
import { Icon } from "./Icon";

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Enables the sort control on this header; value is the sortBy key. */
  sortKey?: string;
  align?: "left" | "right" | "center";
  width?: string;
  /** Hide below the tablet breakpoint. */
  secondary?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  onSort?: (key: string) => void;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onToggleRow?: (id: string) => void;
  onToggleAll?: () => void;
  caption?: string;
  emptyContent?: ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  sortBy,
  sortDir,
  onSort,
  selectable,
  selectedIds,
  onToggleRow,
  onToggleAll,
  caption,
  emptyContent,
}: DataTableProps<T>) {
  const allSelected =
    selectable && rows.length > 0 && rows.every((r) => selectedIds?.has(rowKey(r)));
  const someSelected =
    selectable && rows.some((r) => selectedIds?.has(rowKey(r))) && !allSelected;

  return (
    <div className="gg-table-wrap" role="region" aria-label={caption}>
      <table className="gg-table">
        {caption && <caption className="gg-visually-hidden">{caption}</caption>}
        <thead>
          <tr>
            {selectable && (
              <th className="gg-table__checkcol" scope="col">
                <input
                  type="checkbox"
                  aria-label="Select all rows"
                  checked={!!allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = !!someSelected;
                  }}
                  onChange={onToggleAll}
                />
              </th>
            )}
            {columns.map((col) => {
              const isSorted = sortBy && col.sortKey === sortBy;
              return (
                <th
                  key={col.key}
                  scope="col"
                  className={[
                    col.align ? `gg-align-${col.align}` : "",
                    col.secondary ? "gg-col-secondary" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={col.width ? { width: col.width } : undefined}
                  aria-sort={
                    isSorted
                      ? sortDir === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                >
                  {col.sortKey && onSort ? (
                    <button
                      className="gg-table__sortbtn"
                      onClick={() => onSort(col.sortKey!)}
                    >
                      {col.header}
                      <Icon
                        name={
                          isSorted
                            ? sortDir === "asc"
                              ? "arrowUp"
                              : "arrowDown"
                            : "sort"
                        }
                        size={14}
                        className={
                          isSorted ? "gg-table__sorticon--active" : "gg-table__sorticon"
                        }
                      />
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                className="gg-table__empty"
                colSpan={columns.length + (selectable ? 1 : 0)}
              >
                {emptyContent ?? "No results."}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const id = rowKey(row);
              const selected = selectedIds?.has(id);
              return (
                <tr
                  key={id}
                  className={[
                    onRowClick ? "gg-table__row--clickable" : "",
                    selected ? "gg-table__row--selected" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {selectable && (
                    <td
                      className="gg-table__checkcol"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        aria-label="Select row"
                        checked={!!selected}
                        onChange={() => onToggleRow?.(id)}
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={[
                        col.align ? `gg-align-${col.align}` : "",
                        col.secondary ? "gg-col-secondary" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
