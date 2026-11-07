const hre=require("hardhat"),fs=require("node:fs"),path=require("node:path");
async function main(){
  const [deployer]=await hre.ethers.getSigners(),lifetime=180n,badge="0x07EF486C5d81EFb9627875a85896266980729824";
  const Help=await hre.ethers.getContractFactory("HelpToken"),help=await Help.deploy();await help.waitForDeployment();
  const Forum=await hre.ethers.getContractFactory("ProoflyForumVideoDemo"),forum=await Forum.deploy(await help.getAddress(),deployer.address,deployer.address,hre.ethers.id("proofly-video-demo-asker"),lifetime);await forum.waitForDeployment();
  await(await help.transferOwnership(await forum.getAddress())).wait();
  const network=await hre.ethers.provider.getNetwork(),config=`// Generated for the Proofly Sepolia video demo.\nexport const PROOFLY_CONTRACTS = Object.freeze({\n  chainId: ${network.chainId},\n  helpToken: "${await help.getAddress()}",\n  badge: "${badge}",\n  forum: "${await forum.getAddress()}"\n});\n`;
  fs.writeFileSync(path.join(__dirname,"..","dist","contracts.js"),config);
  console.log("Video HELP:",await help.getAddress());console.log("Video Forum:",await forum.getAddress());console.log("Lifetime: 180 seconds after first answer");
}
main().catch(error=>{console.error(error);process.exitCode=1});
