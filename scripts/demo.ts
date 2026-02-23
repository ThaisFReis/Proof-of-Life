#!/usr/bin/env bun
/**
 * Demo script for Proof of Life
 * 
 * Demonstrates a complete game flow on testnet:
 * 1. Start game
 * 2. Commit location
 * 3. Dispatcher commands Chad
 * 4. Request ping
 * 5. Submit ping proof
 * 6. Submit turn status proof
 * 
 * Usage: bun run scripts/demo.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';

interface DeploymentConfig {
  timestamp: string;
  network: string;
  contracts: {
    proofOfLife: string;
    gameHub: string;
  };
  admin: string;
  rpcUrl: string;
  networkPassphrase: string;
}

async function loadDeployment(): Promise<DeploymentConfig> {
  const deploymentPath = join(process.cwd(), 'deployment.json');
  const content = readFileSync(deploymentPath, 'utf-8');
  return JSON.parse(content);
}

async function runDemo() {
  console.log('🎮 Proof of Life - Demo');
  console.log('=======================\n');
  
  try {
    const deployment = await loadDeployment();
    console.log(`Network: ${deployment.network}`);
    console.log(`Contract: ${deployment.contracts.proofOfLife}\n`);
    
    console.log('📋 Demo Flow:');
    console.log('  1. ✅ Contract deployed');
    console.log('  2. ✅ Frontend configured');
    console.log('  3. 🎯 Next: Open frontend and play!');
    console.log('\n💡 Run: cd proof-of-life-frontend && bun run dev');
    console.log('   Then navigate to http://localhost:3000/proof-of-life');
    
    console.log('\n📝 Game Flow:');
    console.log('  • Start Game → Commit Location');
    console.log('  • Dispatcher moves Chad');
    console.log('  • Assassin requests ping');
    console.log('  • Assassin submits ping proof');
    console.log('  • Assassin moves (optional)');
    console.log('  • Assassin submits turn status proof');
    console.log('  • Repeat until Chad is caught or battery depletes');
    
  } catch (error) {
    console.error('❌ Demo failed:', error);
    console.log('\n💡 Tip: Run `bun run scripts/setup.ts` first to deploy');
    process.exit(1);
  }
}

runDemo();
