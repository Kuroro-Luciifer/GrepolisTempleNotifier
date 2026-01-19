import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default defineEventHandler(async (event) => {
    const origin = getHeader(event, "origin") || "";

    // Autoriser tous les mondes Grepolis FR (ex: fr176.grepolis.com)
    const isGrepolis = /^https:\/\/fr\d+\.grepolis\.com$/i.test(origin);

    if (isGrepolis) {
        setHeader(event, "Access-Control-Allow-Origin", origin);
        setHeader(event, "Vary", "Origin");
        setHeader(event, "Access-Control-Allow-Credentials", "true"); // garde seulement si tu en as besoin
    }

    setHeader(event, "Access-Control-Allow-Methods", "POST, OPTIONS");
    setHeader(event, "Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (event.method === "OPTIONS") {
        event.node.res.statusCode = 204;
        return "";
    }

    const body = await readBody(event)

    if (!body.movementId) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Missing required parameter: movementId',
        });
    }
    if (!body.templeId) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Missing required parameter: templeId',
        });
    }
    if (!body.user) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Missing required parameter: user',
        });
    }
    if (!body.town) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Missing required parameter: town',
        });
    }
    if (!body.type) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Missing required parameter: type',
        });
    }

    try {
        const oldMovement = await prisma.templeMovement.findFirst({
            where: {
                movementId: body.movementId,
                templeId: body.templeId,
            },
        });

        if (oldMovement) {
            return { 
                success: false,
                data: 'Movement already exists' 
            };
        }

        const movement = await prisma.templeMovement.create({
            data: {
                movementId: body.movementId,
                templeId: body.templeId,
                user: body.user,
                town: body.town,
                type: body.type,
            },
        });

        return {
            success: true,
            data: movement
        };

    } catch (error) {
        throw createError({
            statusCode: 400,
            statusMessage: 'Failed to create movement',
        });
    }
});