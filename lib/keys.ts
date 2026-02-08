import { Redis } from '@upstash/redis'
import crypto from 'crypto'

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
})

// Redis key naming:
//   keys:{productId}  -> List of available keys for that product
//   keys:seeded       -> Flag to prevent duplicate seeding

const PRODUCT_IDS = ['shadow-weekly', 'shadow-monthly', 'shadow-lifetime']

const DEFAULT_STOCK: Record<string, number> = {
  'shadow-weekly': 999,
  'shadow-monthly': 500,
  'shadow-lifetime': 100,
}

function generateKey(): string {
  return `SHADOW-${crypto.randomBytes(4).toString('hex').toUpperCase()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`
}

// Auto-seed keys into Redis if they haven't been seeded yet
async function ensureKeysSeeded(): Promise<void> {
  const alreadySeeded = await redis.get('keys:seeded')
  if (alreadySeeded) return

  // Check if any keys exist already (in case seeded flag was lost)
  const pipeline = redis.pipeline()
  for (const id of PRODUCT_IDS) {
    pipeline.llen(`keys:${id}`)
  }
  const counts = await pipeline.exec<number[]>()
  const totalExisting = counts.reduce((sum, c) => sum + (c ?? 0), 0)
  if (totalExisting > 0) {
    // Keys exist but flag is missing, set the flag and return
    await redis.set('keys:seeded', '1')
    return
  }

  // Seed keys
  const seedPipeline = redis.pipeline()
  for (const id of PRODUCT_IDS) {
    const count = DEFAULT_STOCK[id] ?? 50
    for (let i = 0; i < count; i++) {
      seedPipeline.rpush(`keys:${id}`, generateKey())
    }
  }
  seedPipeline.set('keys:seeded', '1')
  await seedPipeline.exec()
}

// Get stock count for a specific product
export async function getStock(productId: string): Promise<number> {
  await ensureKeysSeeded()
  const len = await redis.llen(`keys:${productId}`)
  return len
}

// Get stock for all products
export async function getAllStock(): Promise<Record<string, number>> {
  await ensureKeysSeeded()

  const stock: Record<string, number> = {}

  const pipeline = redis.pipeline()
  for (const id of PRODUCT_IDS) {
    pipeline.llen(`keys:${id}`)
  }
  const results = await pipeline.exec<number[]>()

  for (let i = 0; i < PRODUCT_IDS.length; i++) {
    stock[PRODUCT_IDS[i]] = results[i] ?? 0
  }

  return stock
}

// Claim a key for a product (pops from the list atomically)
export async function claimKey(productId: string): Promise<string | null> {
  await ensureKeysSeeded()
  const key = await redis.lpop<string>(`keys:${productId}`)
  return key ?? null
}

// Add keys to Redis (for admin / seed use)
export async function addKeys(entries: { key: string; productId: string }[]): Promise<boolean> {
  try {
    const pipeline = redis.pipeline()
    for (const { key, productId } of entries) {
      pipeline.rpush(`keys:${productId}`, key)
    }
    await pipeline.exec()
    return true
  } catch (error) {
    console.error('Error adding keys:', error)
    return false
  }
}
