import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(".env") });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function check() {
  const { data: authData, error: err1 } = await supabase.auth.admin.listUsers();
  console.log("--> AUTH USERS LIST:");
  if (err1) console.error(err1);
  else console.log(authData?.users?.map(u => ({ id: u.id, email: u.email })));

  const { data: publicData, error: err2 } = await supabase.from("users").select("*");
  console.log("\\n--> PUBLIC USERS TABLE LIST:");
  if (err2) console.error(err2);
  else console.log(publicData);
}

check();
