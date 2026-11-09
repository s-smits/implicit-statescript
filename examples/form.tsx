// A React form whose submission phase lives in four useState cells, set by hand in each handler.
// prefer-state-union reports the component's cells and no-coupled-flags the setter runs.
import { useState } from "react";

export function SignupForm({ submit }: { submit: (email: string) => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isError, setIsError] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  async function onSubmit() {
    setIsSubmitting(true);
    setIsError(false);
    setIsDone(false);
    try {
      await submit(email);
      setIsSubmitting(false);
      setIsDone(true);
      setIsError(false);
    } catch {
      setIsSubmitting(false);
      setIsError(true);
      setIsDone(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <input value={email} onChange={(event) => (setEmail(event.target.value), setIsDirty(true))} />
      {isSubmitting ? "Sending" : isError ? "Failed" : isDone ? "Thanks" : isDirty ? "" : "Sign up"}
    </form>
  );
}

// Passes: one field names the phase.
export function SignupFormNamed({ submit }: { submit: (email: string) => Promise<void> }) {
  const [phase, setPhase] = useState<"idle" | "submitting" | "error" | "done">("idle");
  async function onSubmit(email: string) {
    setPhase("submitting");
    try {
      await submit(email);
      setPhase("done");
    } catch {
      setPhase("error");
    }
  }
  return [phase, onSubmit] as const;
}
