# Proofly dApp

Proofly is a classroom peer-learning dApp. HELP is an ERC-20-style reward token used for question bounties; Proofly Learning Badges are transferable ERC-721 NFTs. Students can purchase permanent HELP at the demo contract's fixed rate of 100 HELP per ETH. The 1 HELP submission bonus earned for answering a question expires after 90 days; purchased HELP, bounties, and milestone rewards do not expire.

## Open the frontend on localhost

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

## Run the blockchain locally

Run the Solidity unit tests before deploying anything:

```bash
npm run test:forge
```

Only after the Forge suite passes, use four terminals for local integration testing:

```bash
# Terminal 1: local Anvil blockchain
npm run chain

# Terminal 2: deploy the Solidity contract
npm run deploy:local

# Terminal 3: SQLite demo API
npm run api

# Terminal 4: website
npm run dev
```

The deployment command uses the existing Hardhat deployment script against Anvil and automatically writes the HELP, badge, and forum addresses to `dist/contracts.js`. Students do not need to enter contract addresses in the website. Hardhat remains the compiler and automated-test runner; `npm run chain:hardhat` is available as a fallback local node.

The required deployment order is: Forge unit tests → local Anvil deployment and frontend integration tests → public testnet deployment. A local Anvil deployment is disposable and is not a substitute for the Forge test gate.

Run the automated cross-layer integration test while Anvil is running:

```bash
npm run test:integration
```

The API stores demo records in `data/proofly-demo.sqlite`. It uses a fixed demo student rather than a production login system. Wallets are appended only after a one-time nonce message is signed in MetaMask; verified addresses are permanent. Badge minting uses a short-lived EIP-712 authorization signed by the demo API and verified by `ProoflyBadge` on-chain.

Add the local network to MetaMask if needed:

- Network name: Anvil Local
- RPC URL: `http://127.0.0.1:8545`
- Chain ID: `31337`
- Currency symbol: `ETH`

Import one of the development accounts printed by `npm run chain` into MetaMask. These keys are public test keys—never use them for real funds.

## Mint an NFT badge

1. Open the three-dot account menu and choose **Token wallet** to connect MetaMask.
2. Return to the account menu and choose **NFT badges**.
3. Press **Mint badge** and approve the transaction in MetaMask.

The website uses the automatically generated address in `dist/contracts.js`. The Solidity implementation is in `contracts/Proofly.sol`, where `mintLearningBadge()` creates the NFT.

Badge identities and artwork are defined by the six JSON documents in `dist/metadata/` and their matching SVG assets in `dist/badges/`. The interface loads the catalog from those files; metadata URIs are supplied by the application rather than entered by students.

## Sepolia demo deployment

Do not deploy until `npm run test:forge`, `npx hardhat test`, and `npm run test:integration` all pass. Copy the variable names from `.env.example` into your shell or private environment configuration, then run:

```bash
npm run deploy:sepolia
```

`SEPOLIA_RPC_URL` and a funded `DEPLOYER_PRIVATE_KEY` are required. Use a demo-only key. If `BADGE_ISSUER_ADDRESS` is omitted, the deployer becomes the badge authorization issuer. The API must subsequently run with the matching `DEMO_ISSUER_PRIVATE_KEY`. The deployment script updates `dist/contracts.js` with the Sepolia chain ID and deployed addresses.

Current verified Sepolia deployment (chain ID `11155111`):

- HELP token: `0x71A1BcA013F37Da4da1334099bc0F6969060DB2C`
- Proofly badge: `0x07EF486C5d81EFb9627875a85896266980729824`
- Proofly forum: `0x24aC6061FA41Ef43e7AF866E57DEfa41C81E02DF`
- Badge authorization issuer: `0xA1695C15Dc14126F65db33AA826c0bb44d940e6d`
