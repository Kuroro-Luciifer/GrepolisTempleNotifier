import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).end();

    const { movements } = req.body;
    if (!Array.isArray(movements) || movements.length === 0)
        return res.status(400).json({ error: "movements array required" });

    const ids = movements.map(m => m.movementId);

    // 1. Un seul SELECT pour savoir lesquels existent déjà
    const { data: existing } = await supabase
        .from("temple_movements")
        .select("movement_id")
        .in("movement_id", ids);

    const existingSet = new Set((existing || []).map(r => r.movement_id));

    // 2. Filtrer uniquement les nouveaux
    const toInsert = movements
        .filter(m => !existingSet.has(m.movementId))
        .map(m => ({
            movement_id:  m.movementId,
            temple_id:    m.templeId,
            user:         m.user,
            town:         m.town,
            type:         m.type,
            started_at:   m.startedAt,
            arrival_at:   m.arrivalAt,
        }));

    // 3. Un seul INSERT groupé si nécessaire
    if (toInsert.length > 0) {
        await supabase.from("temple_movements").insert(toInsert);
    }

    // 4. Répondre avec le statut de chaque movement
    const results = movements.map(m => ({
        movementId:   m.movementId,
        success:      true,
        alreadyExists: existingSet.has(m.movementId),
    }));

    return res.status(200).json({ results });
}