import { beforeAll, describe, expect, it } from 'vitest';
import { seedDatabase } from '../../../prisma/seed.js';
import { PrismaClient } from '../../../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { startPostgresTestContainer } from "../../helpers/setup/test.containers.js";
import { AccountRepository } from '../../../src/repositories/account.repository.js';
import { execSync } from 'child_process';

describe('Account Repository Integration Tests', () => {
    let accountRepository: AccountRepository;
    let prisma: PrismaClient;
    beforeAll(async () => {
        const { postgres } = await startPostgresTestContainer();
        const testConnectionString = postgres.getConnectionUri();
        process.env['DATABASE_URL'] = testConnectionString;
        const adapter = new PrismaPg({ connectionString: testConnectionString });
        prisma = new PrismaClient({ adapter });

        execSync("npx prisma db push", {
            env: {
                ...process.env,
                DATABASE_URL: testConnectionString,
            },
            stdio: "inherit",
        });

        await seedDatabase(prisma);
        accountRepository = new AccountRepository(prisma);
    });


    describe('findById', () => {
        it('should return an account by id', async () => {
            const account = await accountRepository.findById('11111111-1111-1111-1111-111111111111');
            const accounts = await prisma.account.findMany();
            console.log("åæåø",accounts);
            expect(account).not.toBeNull();
            expect(account?.id).toBe('11111111-1111-1111-1111-111111111111');
        });
    });
});
