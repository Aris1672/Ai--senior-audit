import { createAdminClient } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";

// ─── GET — list all clients with metrics ─────────────────────────────────────
export async function GET() {
  try {
    const supabase = createAdminClient();

    const { data: clients, error } = await supabase
      .from("profiles")
      .select(`
        id,
        full_name,
        company_name,
        inn,
        phone,
        status,
        created_at,
        client_subscriptions (
          id,
          audits_purchased,
          audits_used,
          custom_price_rub,
          custom_max_tx,
          valid_from,
          valid_to,
          notes,
          pricing_tiers (
            name,
            max_transactions,
            price_rub
          )
        ),
        audit_sessions (
          id,
          status,
          transactions_ct,
          findings_ct,
          cost_rub,
          created_at,
          completed_at
        )
      `)
      .eq("role", "client")
      .neq("status", "deleted")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("GET clients error:", error);
      return NextResponse.json(
        { error: "Ошибка получения списка клиентов" },
        { status: 500 }
      );
    }

    return NextResponse.json(clients);

  } catch (err) {
    console.error("GET clients error:", err);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}

// ─── POST — create new client ─────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const supabase = createAdminClient();
    const {
      email, password, fullName,
      companyName, inn, phone, notes,
    } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email и пароль обязательны" },
        { status: 400 }
      );
    }

    // Create auth user
    const { data: authUser, error: authError } =
      await supabase.auth.admin.createUser({
        email,
        password,
        user_metadata: { role: "client" },
        email_confirm: true,
      });

    if (authError || !authUser.user) {
      return NextResponse.json(
        { error: authError?.message || "Ошибка создания пользователя" },
        { status: 400 }
      );
    }

    const userId = authUser.user.id;

    // Force create profile — bypass trigger reliability issues
    await supabase.from("profiles").upsert({
      id:     userId,
      role:   "client",
      status: "active",
    }, { onConflict: "id" });

    // Update with company details
    await supabase.from("profiles").update({
      full_name:    fullName    || null,
      company_name: companyName || null,
      inn:          inn         || null,
      phone:        phone       || null,
      updated_at:   new Date().toISOString(),
    }).eq("id", userId);

    return NextResponse.json({
      success:  true,
      clientId: userId,
      message:  `Клиент ${email} успешно создан`,
    });

  } catch (err) {
    console.error("POST client error:", err);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}

// ─── PATCH — update client (pause / reactivate / update details) ──────────────
export async function PATCH(req: NextRequest) {
  try {
    const supabase = createAdminClient();
    const {
      clientId,
      status,
      fullName,
      companyName,
      inn,
      phone,
    } = await req.json();

    if (!clientId) {
      return NextResponse.json(
        { error: "clientId обязателен" },
        { status: 400 }
      );
    }

    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (status)      updates.status       = status;
    if (fullName)    updates.full_name    = fullName;
    if (companyName) updates.company_name = companyName;
    if (inn)         updates.inn          = inn;
    if (phone)       updates.phone        = phone;

    const { error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", clientId);

    if (error) {
      console.error("PATCH client error:", error);
      return NextResponse.json(
        { error: "Ошибка обновления клиента" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: status === "paused"
        ? "Аккаунт клиента приостановлен"
        : status === "active"
        ? "Аккаунт клиента активирован"
        : "Данные клиента обновлены",
    });

  } catch (err) {
    console.error("PATCH client error:", err);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}

// ─── DELETE — soft delete client ─────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const supabase = createAdminClient();
    const { clientId } = await req.json();

    if (!clientId) {
      return NextResponse.json(
        { error: "clientId обязателен" },
        { status: 400 }
      );
    }

    // Soft delete — mark as deleted, don't remove from DB
    const { error } = await supabase
      .from("profiles")
      .update({
        status:     "deleted",
        updated_at: new Date().toISOString(),
      })
      .eq("id", clientId);

    if (error) {
      console.error("DELETE client error:", error);
      return NextResponse.json(
        { error: "Ошибка удаления клиента" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Клиент удалён",
    });

  } catch (err) {
    console.error("DELETE client error:", err);
    return NextResponse.json(
      { error: "Внутренняя ошибка сервера" },
      { status: 500 }
    );
  }
}