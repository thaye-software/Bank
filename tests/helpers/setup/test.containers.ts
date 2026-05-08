import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";

export interface TestContainers {
  postgres: StartedPostgreSqlContainer;
}

let containers: TestContainers | null = null;

export async function startPostgresTestContainer(): Promise<TestContainers> {
  if (containers) return containers;

  console.log("🐳 Starting test container...");

  const postgres = await new PostgreSqlContainer("postgres:17")
    .withDatabase("test_db")
    .withUsername("test_user")
    .withPassword("test_pass")
    .start();

  console.log("✅ Postgres container started");

  containers = { postgres };
  return containers;
}

export async function stopPostgresTestContainer(): Promise<void> {
  if (!containers) return;

  console.log("🐳 Stopping test container...");
  await containers.postgres.stop();
  containers = null;
  console.log("✅ Postgres container stopped");
}
