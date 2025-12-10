export interface IPinterestBoardResponse {
    items: IPinterestBoard[]
    bookmark: string | null
}

export interface IPinterestBoard {
    id: string
    created_at: string // ISO 8601
    board_pins_modified_at: string // ISO 8601
    name: string
    description: string
    collaborator_count: number
    pin_count: number
    follower_count: number
    media: IPinterestBoardMedia
    owner: IPinterestBoardOwner
    privacy: PinterestBoardPrivacy
    is_ads_only: boolean
}

export interface IPinterestBoardMedia {
    image_cover_url: string
    pin_thumbnail_urls: string[]
}

export interface IPinterestBoardOwner {
    username: string
}

export type PinterestBoardPrivacy = 'PUBLIC' | 'PROTECTED' | 'SECRET'
