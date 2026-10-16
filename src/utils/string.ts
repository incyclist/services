export const ignoreEmpty = (str?:string) =>{
    if (str?.length)
        return str    
}

export const camelCase = (str: string) => {
    if (!str?.length)
        return str

    return str
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((word, i) => i === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1))
        .join('')
}

export const pascalCase = (str: string) => {
    if (!str?.length)
        return str

    return str
        .toLowerCase()
        .replace(new RegExp(/[-_ ]+/, 'g'), ' ') // Standardize delimiters to spaces
        .replace(/(?:^\w|\b\w)/g, letter => letter.toUpperCase()) // Capitalize first letter of every word
        .replaceAll(' ', ''); // Remove spaces
}