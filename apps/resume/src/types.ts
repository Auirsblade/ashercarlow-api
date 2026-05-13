export interface ExperienceData {
    employer: string,
    location?: string,
    timespan: string,
    link?: string,
    positions: PositionData[],
    tags?: string[]
}

export interface PositionData {
    title: string,
    points: string[]
}