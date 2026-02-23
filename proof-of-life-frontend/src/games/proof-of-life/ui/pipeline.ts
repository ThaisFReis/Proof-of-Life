export function shouldRunAssassinTickFallback(params: { devMode: boolean; pingProofConfirmed: boolean; zkVerifiersReady: boolean }): boolean {
  const { devMode, pingProofConfirmed, zkVerifiersReady } = params;
  return devMode && zkVerifiersReady && !pingProofConfirmed;
}
