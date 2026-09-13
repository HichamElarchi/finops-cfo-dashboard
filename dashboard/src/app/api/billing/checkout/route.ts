import { NextResponse } from "next/server";
import { requireRole } from "@/lib/profile";

export async function POST() {
  const auth = await requireRole("cfo");
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  const priceId = process.env.NEXT_PUBLIC_STRIPE_PRICE_ID;
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!publishableKey || !priceId || !secretKey) {
    return NextResponse.json({
      placeholder: true,
      message:
        "Stripe is not configured yet. Add STRIPE_SECRET_KEY, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY and NEXT_PUBLIC_STRIPE_PRICE_ID.",
      checkout_url: null,
    });
  }

  return NextResponse.json({
    placeholder: false,
    checkout_url: `https://checkout.stripe.com/c/pay/placeholder?price=${priceId}`,
  });
}
