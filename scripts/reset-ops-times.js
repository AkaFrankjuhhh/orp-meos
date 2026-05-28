const { withClient, closePool } = require("../modules/db");

async function main() {
  await withClient(async (client) => {
    await client.query(`
      insert into app_settings(key, value, updated_at)
      values('main', jsonb_build_object('portoOpsLog', '[]'::jsonb), now())
      on conflict(key) do update set
        value = coalesce(app_settings.value, '{}'::jsonb) || jsonb_build_object('portoOpsLog', '[]'::jsonb),
        updated_at = now()
    `);
  });
  console.log("OPS tijden zijn leeggemaakt. Nieuwe OPS diensten tellen vanaf nu opnieuw op.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
