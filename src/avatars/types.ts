
export type Color = 'yellow' |'red' |'blue' | 'green' | 'purple'| 'orange'| 'hotpink'| 'brown'| 'grey'| 'black'| 'white' | 'violet' | 'lime' | 'olive' | 'cyan' | 'skyblue'

export type Avatar  = {
    helmet: Color,
    shirt:Color,
    type?: string
}

export type AvatarOption = {
    avatar: Avatar,
    usageCnt: number    
}

