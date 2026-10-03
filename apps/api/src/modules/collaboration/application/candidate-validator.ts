/** Application validation port; the bounded worker adapter owns execution and diagnostics. */
export interface CandidateValidationInput {
  readonly acceptedState: Uint8Array;
  readonly update: Uint8Array;
  readonly reconstruction?: { readonly updates: readonly Uint8Array[]; readonly remap: boolean };
}

export abstract class CandidateValidator {
  public abstract validate(
    input: CandidateValidationInput,
  ): Promise<{ readonly candidateState: Uint8Array }>;
}
