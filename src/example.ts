// This example demonstrates a BananaTree class for testing the linting tool
interface Banana {
  ripeness: 'green' | 'yellow' | 'brown';
  size: number;
}

class BananaTree {
  private bananas: Banana[] = [];

  addBanana(banana: Banana): void {
    this.bananas.push(banana);
  }

  getBananas(): Banana[] {
    return this.bananas;
  }

  harvestRipeBananas(): Banana[] {
    try {
      const ripe = this.bananas.filter(b => b.ripeness === 'yellow');
      this.bananas = this.bananas.filter(b => b.ripeness !== 'yellow');
      return ripe;
    } catch (error) {
      throw new Error(`Failed to harvest ripe bananas: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  getTotalBananas(): number {
    return this.bananas.length;
  }
}

const tree = new BananaTree();
tree.addBanana({ ripeness: 'green', size: 15 });
tree.addBanana({ ripeness: 'yellow', size: 18 });
tree.addBanana({ ripeness: 'yellow', size: 16 });
tree.addBanana({ ripeness: 'brown', size: 14 });

// Get total bananas and harvest ripe ones
const totalBefore = tree.getTotalBananas();
console.log(`Total bananas before harvest: ${totalBefore}`);

const harvested = tree.harvestRipeBananas();
console.log(`Harvested ${harvested.length} ripe bananas:`, harvested);

const totalAfter = tree.getTotalBananas();
console.log(`Total bananas remaining: ${totalAfter}`);
