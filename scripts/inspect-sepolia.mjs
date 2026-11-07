import { ethers } from "ethers";

const privateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
const rpcUrl = (process.env.SEPOLIA_RPC_URL || "")
  .replace("$(ALCHEMY_KEY)", process.env.ALCHEMY_KEY || "")
  .replace("${ALCHEMY_KEY}", process.env.ALCHEMY_KEY || "");
const wallet = new ethers.Wallet(privateKey);
const provider = new ethers.JsonRpcProvider(rpcUrl);
const latest = await provider.getBlockNumber();
const confirmedNonce = await provider.getTransactionCount(wallet.address, "latest");
const pendingNonce = await provider.getTransactionCount(wallet.address, "pending");
const transactions = [];
const blockNumbers = Array.from({ length: 12 }, (_, index) => latest - index).filter(number => number >= 0);
const blocks = await Promise.all(blockNumbers.map(number => provider.getBlock(number, true)));
for (const block of blocks) {
  for (const transaction of block.prefetchedTransactions) {
    if (transaction.from?.toLowerCase() === wallet.address.toLowerCase()) {
      const receipt = await provider.getTransactionReceipt(transaction.hash);
      transactions.push({ block: block.number, nonce: transaction.nonce, hash: transaction.hash, creates: receipt?.contractAddress || null, status: receipt?.status ?? null });
    }
  }
}
console.log(JSON.stringify({ address: wallet.address, latestBlock: latest, confirmedNonce, pendingNonce, recentTransactions: transactions }, null, 2));
