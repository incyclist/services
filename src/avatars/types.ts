
export type Color = 'yellow' |'red' |'blue' | 'green' | 'purple'| 'orange'| 'pink'| 'brown'| 'grey'| 'black'| 'white' 

export type Avatar  = {
    helmet: Color,
    shirt:Color,
}

export type AvatarOption = {
    avatar: Avatar,
    usageCnt: number    
}

