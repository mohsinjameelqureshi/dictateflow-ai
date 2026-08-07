import { Empty, Page } from "@/components/page.js";

/**
 * Transform — rules that reshape a transcript after it is captured.
 *
 * Scaffold only. The route, the nav entry and the frame are real so the
 * destination is not a dead link; what a rule IS has not been decided yet, and
 * guessing it would mean building a schema and an editor that get thrown away.
 *
 * Whatever it becomes, it runs in the pipeline AFTER the LLM step and beside
 * the dictionary (§9): a deterministic pass over text the model has already
 * finished with, so the model cannot "correct" the correction back.
 */
export function TransformPage() {
  return (
    <Page
      title="Transform"
      description="Rules that reshape a transcript after it is captured."
    >
      <Empty
        title="Nothing here yet"
        hint="Transform rules are not built. The section exists so the shape of the app is settled."
      />
    </Page>
  );
}
