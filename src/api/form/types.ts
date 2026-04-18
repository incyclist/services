
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Form {}

export interface IFormPostBinding {
    createForm(opts,uploadInfo):Promise<Form>
    post(opts:Form)
}