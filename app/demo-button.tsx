import { startDemoAction } from "./demo-actions";
import { DemoSubmit } from "./demo-submit";

/** Opens a private sandbox workspace (deleted after 24 hours). */
export function DemoButton() {
  return (
    <form action={startDemoAction}>
      <DemoSubmit />
    </form>
  );
}
