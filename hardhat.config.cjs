require("@nomicfoundation/hardhat-toolbox");

const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
const sepoliaRpcUrl = (process.env.SEPOLIA_RPC_URL || "").replace("$(ALCHEMY_KEY)", process.env.ALCHEMY_KEY || "").replace("${ALCHEMY_KEY}", process.env.ALCHEMY_KEY || "");
const sepoliaReady = Boolean(sepoliaRpcUrl && deployerPrivateKey);

module.exports = {
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" }
  },
  networks: {
    hardhat: { chainId: 31337 },
    ...(sepoliaReady ? { sepolia: { url: sepoliaRpcUrl, accounts: [deployerPrivateKey], chainId: 11155111 } } : {})
  }
};
