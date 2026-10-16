export const ignoreEmpty = (str?:string) =>{
    if (str?.length)
        return str    
}

export const camelCase = (str: string) =>  {
    if (!str?.length)
        return str
    return str.toLowerCase().replace(/[^a-zA-Z0-9]+(.)/g, (_, chr) => chr.toUpperCase());
}

export const pascalCase = (str: string) =>  {
    if (!str?.length)
        return str
    return str
        .toLowerCase()
        .replace(new RegExp(/[-_ ]+/, 'g'), ' ') // Standardize delimiters to spaces
        .replace(/(?:^\w|\b\w)/g, letter => letter.toUpperCase()) // Capitalize first letter of every word
        .replace(/ /g, ''); // Remove spaces
}