"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

/** What every server action in this app returns when it worked. */
type ActionState = { success?: string | null };

/**
 * Raise the success toast for a `useActionState` result, and run whatever the
 * form wants to do afterwards — close itself, reset, clear a file name.
 *
 * Written out by hand this was eleven copies of the same effect, three of them
 * carrying an `eslint-disable` for `exhaustive-deps`: the callback is usually an
 * inline arrow, so listing it as a dependency re-runs the effect on every render
 * and closes the form the moment anything else changes. Keeping it in a ref
 * fixes that properly rather than silencing the rule, and the effect depends on
 * the one thing it should — a new result from the action.
 */
export function useActionToast(state: ActionState, onSuccess?: () => void) {
  const callback = useRef(onSuccess);

  // Declared first so a callback that changed in the same commit is in place
  // before the effect below reads it.
  useEffect(() => {
    callback.current = onSuccess;
  });

  useEffect(() => {
    if (!state.success) return;
    toast.success(state.success);
    callback.current?.();
  }, [state]);
}
