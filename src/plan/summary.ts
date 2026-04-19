import type { PlanResult } from "../modes/plan.ts";

// Marker at the top of every comment this Action posts. Allows the
// next run to find and update its own comment instead of spamming.
// Do not rename lightly — changing this orphans existing comments.
export const COMMENT_MARKER = "<!-- repo-manifest:plan-comment:v1 -->";

export function renderPlanMarkdown(plan: PlanResult): string {
  const sections: string[] = [COMMENT_MARKER];
  sections.push("## \ud83d\udcd1 repo-manifest plan");

  if (plan.changedCount === 0) {
    sections.push("**No changes.** Everything matches the manifest.");
    sections.push(planDetails(plan));
    return sections.join("\n\n");
  }

  const noun = plan.changedCount === 1 ? "change" : "changes";
  sections.push(`**${plan.changedCount} ${noun}** pending.`);
  sections.push(planDetails(plan));
  return sections.join("\n\n");
}

function planDetails(plan: PlanResult): string {
  const lines: string[] = [];
  for (const entry of plan.plans) {
    if (entry.error) {
      lines.push(
        `<details><summary>\u26a0\ufe0f <code>${entry.name}</code>: error</summary>\n\n\`\`\`\n${entry.error}\n\`\`\`\n</details>`,
      );
      continue;
    }
    if (!entry.configured) {
      lines.push(`- <code>${entry.name}</code>: not configured`);
      continue;
    }
    if (entry.changes.length === 0) {
      lines.push(`- \u2705 <code>${entry.name}</code>: no changes`);
      continue;
    }
    const noun = entry.changes.length === 1 ? "change" : "changes";
    lines.push(
      `<details open><summary><code>${entry.name}</code>: ${entry.changes.length} ${noun}</summary>\n\n\`\`\`diff\n${entry.formatted}\n\`\`\`\n</details>`,
    );
  }
  return lines.join("\n");
}
