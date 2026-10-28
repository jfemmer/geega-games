import { useMemo } from "react";
import { parseAgreement, type Inline } from "../../lib/consignmentAgreement";

// The consignment agreement's text, from the same blocks the signed PDF is
// drawn from, so what a consignor reads is what the PDF shows. Headings are
// demoted one level (the page has its own h1).

function Runs({ runs }: { runs: Inline[] }) {
  return (
    <>
      {runs.map((r, i) => (r.bold ? <strong key={i}>{r.text}</strong> : <span key={i}>{r.text}</span>))}
    </>
  );
}

export function AgreementText({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => parseAgreement(markdown), [markdown]);
  return (
    <div className="gg-agreement">
      {blocks.map((b, i) => {
        switch (b.type) {
          case "heading":
            return b.level <= 2 ? (
              <h2 key={i} className="gg-agreement__h2">
                <Runs runs={b.text} />
              </h2>
            ) : (
              <h3 key={i} className="gg-agreement__h3">
                <Runs runs={b.text} />
              </h3>
            );
          case "paragraph":
            return (
              <p key={i}>
                <Runs runs={b.text} />
              </p>
            );
          case "list": {
            const Tag = b.ordered ? "ol" : "ul";
            return (
              <Tag key={i}>
                {b.items.map((item, j) => (
                  <li key={j}>
                    <Runs runs={item} />
                  </li>
                ))}
              </Tag>
            );
          }
          case "table":
            return (
              <div key={i} className="gg-agreement__table">
                <table>
                  <thead>
                    <tr>
                      {b.header.map((c, j) => (
                        <th key={j} scope="col">
                          <Runs runs={c} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, j) => (
                      <tr key={j}>
                        {row.map((c, k) => (
                          <td key={k}>
                            <Runs runs={c} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}

export default AgreementText;
