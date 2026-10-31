import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
export const pool = new pg.Pool({connectionString: process.env.DATABASE_URL,max:8,connectionTimeoutMillis:3000,statement_timeout:4500});
export const database = drizzle(pool);
export async function scoped<T>(tenant:string,fn:(client:pg.PoolClient)=>Promise<T>):Promise<T> {
 const c=await pool.connect();
 try { await c.query('BEGIN'); await c.query("SELECT set_config('bb.tenant_id',$1,true)",[tenant]); const result=await fn(c); await c.query('COMMIT'); return result; }
 catch(e){await c.query('ROLLBACK');throw e;} finally{c.release();}
}
