import { Redis } from '@upstash/redis'

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
})

// Redis key naming:
//   keys:{productId}  -> List of available keys for that product

const PRODUCT_IDS = ['shadow-weekly', 'shadow-monthly', 'shadow-lifetime']

// Get stock count for a specific product
export async function getStock(productId: string): Promise<number> {
  const len = await redis.llen(`keys:${productId}`)
  return len
}

// Get stock for all products
export async function getAllStock(): Promise<Record<string, number>> {
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
