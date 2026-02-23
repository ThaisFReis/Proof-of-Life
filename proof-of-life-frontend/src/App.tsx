import { config } from './config';

import { useWallet } from './hooks/useWallet';
import { useWalletStandalone } from './hooks/useWalletStandalone';
import { ProofOfLifeGame } from './games/proof-of-life/ProofOfLifeGame';

const GAME_ID = 'proof-of-life';
const GAME_TITLE = import.meta.env.VITE_GAME_TITLE || 'Proof Of Life';
const GAME_TAGLINE = import.meta.env.VITE_GAME_TAGLINE || 'On-chain game on Stellar';

const walletMode = (import.meta.env.VITE_WALLET_MODE as string) || 'standalone';

export default function App() {
  const devWallet = useWallet();
  const standaloneWallet = useWalletStandalone();

  const useStandalone = walletMode === 'standalone';
  const wallet = useStandalone ? standaloneWallet : devWallet;

  const { publicKey, isConnected, isConnecting, error, getContractSigner } = wallet;
  const userAddress = publicKey ?? '';
  const contractId = config.contractIds[GAME_ID] || '';
  const hasContract = Boolean(contractId && contractId !== 'YOUR_CONTRACT_ID');
  const devReady = useStandalone ? standaloneWallet.isWalletAvailable : devWallet.isDevModeAvailable();

  return (
    <div className="h-screen w-full bg-black">
      <ProofOfLifeGame
        userAddress={userAddress}
        getContractSigner={getContractSigner}
        wallet={{
          isConnected,
          isConnecting,
          error,
          connect: useStandalone ? standaloneWallet.connect : undefined,
          disconnect: useStandalone ? standaloneWallet.disconnect : undefined,
          connectDev: devWallet.connectDev,
          switchPlayer: devWallet.switchPlayer,
          walletId: wallet.walletId,
          walletType: useStandalone ? 'wallet' : 'dev',
          devReady,
          hasContract
        }}
      />
      <div className="pol-builtBadge">Built with Stellar Game Studio</div>
    </div>
  );
}
