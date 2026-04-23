import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default defineEventHandler(async (event) => {
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