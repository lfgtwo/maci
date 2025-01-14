import { Keypair } from "maci-domainobjs";

export const voiceCreditBalance = 100n;
export const duration = 30;
export const messageBatchSize = 20;
export const coordinatorKeypair = new Keypair();

export const maxValues = {
  maxUsers: 25,
};

export const treeDepths = {
  intStateTreeDepth: 2,
  voteOptionTreeDepth: 4,
};
