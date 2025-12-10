import { z } from 'zod'

export const userSchema = z.object({
    id: z.string().uuid(),
    name: z.string().min(1),
    email: z.string().email(),
    googleAuth: z.boolean(),
    avatar: z.string(),
    createdAt: z.coerce.date(),
    // Backward compatibility fields
    googleId: z.string().optional(),
    trialEndsAt: z.date().optional(),
    picture: z.string().optional(),
})

export type UserSchema = z.infer<typeof userSchema>

export const transformUser = (user: any) => {
    return userSchema.parse({
        ...user,
        googleId: user.googleAuth ? 'google-authenticated' : '',
        trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        picture: user.avatar,
    })
}

// Helper function to transform multiple users
export const transformUsers = (users: any[]) => {
    return users.map(transformUser)
}
